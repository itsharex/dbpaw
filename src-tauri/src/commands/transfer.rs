use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use tauri::State;

const DEFAULT_CHUNK_SIZE: i64 = 2000;
const MAX_IMPORT_FILE_SIZE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_IMPORT_STATEMENTS: usize = 50_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Csv,
    Json,
    Sql,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportScope {
    CurrentPage,
    Filtered,
    FullTable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub file_path: String,
    pub row_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSqlResult {
    pub file_path: String,
    pub total_statements: i64,
    pub success_statements: i64,
    pub failed_at: Option<i64>,
    pub error: Option<String>,
    pub time_taken_ms: i64,
    pub rolled_back: bool,
}

#[tauri::command]
pub async fn export_table_data(
    state: State<'_, AppState>,
    id: i64,
    database: Option<String>,
    schema: String,
    table: String,
    driver: String,
    format: ExportFormat,
    scope: ExportScope,
    filter: Option<String>,
    order_by: Option<String>,
    sort_column: Option<String>,
    sort_direction: Option<String>,
    page: Option<i64>,
    limit: Option<i64>,
    file_path: Option<String>,
    chunk_size: Option<i64>,
) -> Result<ExportResult, String> {
    let output_path = resolve_output_path(file_path, &table, extension_for_format(&format))?;

    let chunk = chunk_size.unwrap_or(DEFAULT_CHUNK_SIZE).max(1);

    super::execute_with_retry(&state, id, database, |db_driver| {
        let output_path = output_path.clone();
        let schema = schema.clone();
        let table = table.clone();
        let driver = driver.clone();
        let filter = filter.clone();
        let order_by = order_by.clone();
        let sort_column = sort_column.clone();
        let sort_direction = sort_direction.clone();
        let scope = scope.clone();
        let format = format.clone();
        async move {
            let columns = db_driver
                .get_table_metadata(schema.clone(), table.clone())
                .await?
                .columns
                .into_iter()
                .map(|c| c.name)
                .collect::<Vec<_>>();

            let mut writer =
                ExportWriter::new(output_path.clone(), format.clone(), columns.clone())?;
            let mut exported = 0i64;

            match scope {
                ExportScope::CurrentPage => {
                    let use_page = page.unwrap_or(1).max(1);
                    let use_limit = limit.unwrap_or(50).max(1);
                    let resp = db_driver
                        .get_table_data_chunk(
                            schema.clone(),
                            table.clone(),
                            use_page,
                            use_limit,
                            sort_column.clone(),
                            sort_direction.clone(),
                            filter.clone(),
                            order_by.clone(),
                        )
                        .await?;
                    exported +=
                        writer.write_rows(&resp.data, &columns, Some(&schema), &table, &driver)?;
                }
                ExportScope::Filtered | ExportScope::FullTable => {
                    let filter_for_scope = if matches!(scope, ExportScope::Filtered) {
                        filter.clone()
                    } else {
                        None
                    };
                    let order_for_scope = if matches!(scope, ExportScope::Filtered) {
                        order_by.clone()
                    } else {
                        None
                    };
                    let sort_col_for_scope = if matches!(scope, ExportScope::Filtered) {
                        sort_column.clone()
                    } else {
                        None
                    };
                    let sort_dir_for_scope = if matches!(scope, ExportScope::Filtered) {
                        sort_direction.clone()
                    } else {
                        None
                    };

                    let mut current_page = 1;
                    loop {
                        let resp = db_driver
                            .get_table_data_chunk(
                                schema.clone(),
                                table.clone(),
                                current_page,
                                chunk,
                                sort_col_for_scope.clone(),
                                sort_dir_for_scope.clone(),
                                filter_for_scope.clone(),
                                order_for_scope.clone(),
                            )
                            .await?;
                        if resp.data.is_empty() {
                            break;
                        }

                        exported += writer.write_rows(
                            &resp.data,
                            &columns,
                            Some(&schema),
                            &table,
                            &driver,
                        )?;
                        if exported >= resp.total {
                            break;
                        }
                        current_page += 1;
                    }
                }
            }

            writer.finish()?;
            Ok(ExportResult {
                file_path: output_path.to_string_lossy().to_string(),
                row_count: exported,
            })
        }
    })
    .await
}

#[tauri::command]
pub async fn export_query_result(
    state: State<'_, AppState>,
    id: i64,
    database: Option<String>,
    sql: String,
    driver: String,
    format: ExportFormat,
    file_path: Option<String>,
) -> Result<ExportResult, String> {
    let output_path =
        resolve_output_path(file_path, "query_result", extension_for_format(&format))?;

    super::execute_with_retry(&state, id, database, |db_driver| {
        let output_path = output_path.clone();
        let driver = driver.clone();
        let sql = sql.clone();
        let format = format.clone();
        async move {
            let result = db_driver.execute_query(sql).await?;
            let columns = result
                .columns
                .into_iter()
                .map(|c| c.name)
                .collect::<Vec<_>>();
            let mut writer = ExportWriter::new(output_path.clone(), format, columns.clone())?;
            let exported =
                writer.write_rows(&result.data, &columns, None, "query_result", &driver)?;
            writer.finish()?;
            Ok(ExportResult {
                file_path: output_path.to_string_lossy().to_string(),
                row_count: exported,
            })
        }
    })
    .await
}

#[tauri::command]
pub async fn import_sql_file(
    state: State<'_, AppState>,
    id: i64,
    database: Option<String>,
    file_path: String,
    driver: String,
) -> Result<ImportSqlResult, String> {
    let normalized_driver = driver.trim().to_ascii_lowercase();
    if normalized_driver != "postgres" && normalized_driver != "mysql" {
        return Err(format!(
            "[UNSUPPORTED] Driver {} is not supported for SQL import",
            driver
        ));
    }

    let import_path = PathBuf::from(file_path.trim());
    validate_import_path(&import_path)?;
    validate_import_file_size(&import_path)?;

    let source = fs::read_to_string(&import_path)
        .map_err(|e| format!("[IMPORT_ERROR] failed to read sql file: {e}"))?;
    let source = source
        .strip_prefix('\u{feff}')
        .unwrap_or(&source)
        .to_string();

    let statements = parse_sql_statements(&source, &normalized_driver)?;
    if statements.is_empty() {
        return Err("[IMPORT_ERROR] SQL file does not contain executable statements".to_string());
    }
    if statements.len() > MAX_IMPORT_STATEMENTS {
        return Err(format!(
            "[IMPORT_ERROR] statement count exceeds limit ({} > {})",
            statements.len(),
            MAX_IMPORT_STATEMENTS
        ));
    }

    let started_at = std::time::Instant::now();
    let total_statements = statements.len() as i64;

    super::execute_with_retry(&state, id, database, |db_driver| {
        let statements = statements.clone();
        let import_path = import_path.clone();
        async move {
            db_driver
                .execute_query("BEGIN".to_string())
                .await
                .map_err(|e| format!("[IMPORT_ERROR] failed to start transaction: {e}"))?;

            let mut success_statements = 0i64;
            for (idx, statement) in statements.iter().enumerate() {
                if let Err(e) = db_driver.execute_query(statement.clone()).await {
                    let _ = db_driver.execute_query("ROLLBACK".to_string()).await;
                    return Ok(ImportSqlResult {
                        file_path: import_path.to_string_lossy().to_string(),
                        total_statements,
                        success_statements,
                        failed_at: Some((idx + 1) as i64),
                        error: Some(truncate_error_message(&e)),
                        time_taken_ms: started_at.elapsed().as_millis() as i64,
                        rolled_back: true,
                    });
                }
                success_statements += 1;
            }

            if let Err(e) = db_driver.execute_query("COMMIT".to_string()).await {
                let _ = db_driver.execute_query("ROLLBACK".to_string()).await;
                return Ok(ImportSqlResult {
                    file_path: import_path.to_string_lossy().to_string(),
                    total_statements,
                    success_statements,
                    failed_at: None,
                    error: Some(format!(
                        "[IMPORT_ERROR] failed to commit transaction: {}",
                        truncate_error_message(&e)
                    )),
                    time_taken_ms: started_at.elapsed().as_millis() as i64,
                    rolled_back: true,
                });
            }

            Ok(ImportSqlResult {
                file_path: import_path.to_string_lossy().to_string(),
                total_statements,
                success_statements: total_statements,
                failed_at: None,
                error: None,
                time_taken_ms: started_at.elapsed().as_millis() as i64,
                rolled_back: false,
            })
        }
    })
    .await
}

fn extension_for_format(format: &ExportFormat) -> &'static str {
    match format {
        ExportFormat::Csv => "csv",
        ExportFormat::Json => "json",
        ExportFormat::Sql => "sql",
    }
}

fn resolve_output_path(
    explicit_path: Option<String>,
    base_name: &str,
    extension: &str,
) -> Result<PathBuf, String> {
    let path = if let Some(path) = explicit_path {
        let trimmed = path.trim().to_string();
        if trimmed.is_empty() {
            default_output_path(base_name, extension)
        } else {
            PathBuf::from(trimmed)
        }
    } else {
        default_output_path(base_name, extension)
    };

    validate_output_path(&path)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("[EXPORT_ERROR] create dir failed: {e}"))?;
    }
    Ok(path)
}

fn validate_import_path(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("[IMPORT_ERROR] Invalid import path".to_string());
    }
    if path.is_dir() {
        return Err("[IMPORT_ERROR] Import path points to a directory".to_string());
    }
    if !path.exists() {
        return Err("[IMPORT_ERROR] Import file does not exist".to_string());
    }
    let Some(ext) = path.extension().and_then(|v| v.to_str()) else {
        return Err("[IMPORT_ERROR] Import file must use .sql extension".to_string());
    };
    if !ext.eq_ignore_ascii_case("sql") {
        return Err("[IMPORT_ERROR] Import file must use .sql extension".to_string());
    }
    Ok(())
}

fn validate_import_file_size(path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(path)
        .map_err(|e| format!("[IMPORT_ERROR] failed to read file metadata: {e}"))?;
    if metadata.len() > MAX_IMPORT_FILE_SIZE_BYTES {
        return Err(format!(
            "[IMPORT_ERROR] file is too large (max {} bytes)",
            MAX_IMPORT_FILE_SIZE_BYTES
        ));
    }
    Ok(())
}

#[derive(Debug, Clone)]
enum SqlScanState {
    Normal,
    SingleQuoted,
    DoubleQuoted,
    BacktickQuoted,
    DollarQuoted(String),
    LineComment,
    BlockComment,
}

fn parse_sql_statements(sql: &str, driver: &str) -> Result<Vec<String>, String> {
    let mysql_style_hash_comment = matches!(driver, "mysql" | "mariadb" | "tidb");
    let chars: Vec<char> = sql.chars().collect();
    let mut out = Vec::new();
    let mut current = String::new();
    let mut state = SqlScanState::Normal;
    let mut i = 0usize;

    while i < chars.len() {
        match &state {
            SqlScanState::Normal => {
                let ch = chars[i];
                let next = chars.get(i + 1).copied();

                if ch == '-' && next == Some('-') {
                    state = SqlScanState::LineComment;
                    i += 2;
                    continue;
                }
                if mysql_style_hash_comment && ch == '#' {
                    state = SqlScanState::LineComment;
                    i += 1;
                    continue;
                }
                if ch == '/' && next == Some('*') {
                    state = SqlScanState::BlockComment;
                    i += 2;
                    continue;
                }
                if ch == '\'' {
                    current.push(ch);
                    state = SqlScanState::SingleQuoted;
                    i += 1;
                    continue;
                }
                if ch == '"' {
                    current.push(ch);
                    state = SqlScanState::DoubleQuoted;
                    i += 1;
                    continue;
                }
                if ch == '`' {
                    current.push(ch);
                    state = SqlScanState::BacktickQuoted;
                    i += 1;
                    continue;
                }
                if ch == '$' {
                    if let Some((tag, end_idx)) = parse_dollar_quote_tag(&chars, i) {
                        current.push_str(&tag);
                        state = SqlScanState::DollarQuoted(tag);
                        i = end_idx + 1;
                        continue;
                    }
                }
                if ch == ';' {
                    let statement = current.trim();
                    if !statement.is_empty() {
                        out.push(statement.to_string());
                    }
                    current.clear();
                    i += 1;
                    continue;
                }
                current.push(ch);
                i += 1;
            }
            SqlScanState::SingleQuoted => {
                let ch = chars[i];
                current.push(ch);
                if ch == '\\' {
                    if let Some(next) = chars.get(i + 1) {
                        current.push(*next);
                        i += 2;
                        continue;
                    }
                }
                if ch == '\'' {
                    if chars.get(i + 1) == Some(&'\'') {
                        current.push('\'');
                        i += 2;
                        continue;
                    }
                    state = SqlScanState::Normal;
                }
                i += 1;
            }
            SqlScanState::DoubleQuoted => {
                let ch = chars[i];
                current.push(ch);
                if ch == '"' {
                    if chars.get(i + 1) == Some(&'"') {
                        current.push('"');
                        i += 2;
                        continue;
                    }
                    state = SqlScanState::Normal;
                }
                i += 1;
            }
            SqlScanState::BacktickQuoted => {
                let ch = chars[i];
                current.push(ch);
                if ch == '`' {
                    if chars.get(i + 1) == Some(&'`') {
                        current.push('`');
                        i += 2;
                        continue;
                    }
                    state = SqlScanState::Normal;
                }
                i += 1;
            }
            SqlScanState::DollarQuoted(tag) => {
                if starts_with_tag(&chars, i, tag) {
                    current.push_str(tag);
                    i += tag.chars().count();
                    state = SqlScanState::Normal;
                    continue;
                }
                current.push(chars[i]);
                i += 1;
            }
            SqlScanState::LineComment => {
                if chars[i] == '\n' {
                    current.push('\n');
                    state = SqlScanState::Normal;
                }
                i += 1;
            }
            SqlScanState::BlockComment => {
                if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    state = SqlScanState::Normal;
                    i += 2;
                } else {
                    i += 1;
                }
            }
        }
    }

    match state {
        SqlScanState::Normal | SqlScanState::LineComment => {}
        SqlScanState::BlockComment => {
            return Err("[IMPORT_ERROR] Unterminated block comment in SQL file".to_string());
        }
        SqlScanState::SingleQuoted
        | SqlScanState::DoubleQuoted
        | SqlScanState::BacktickQuoted
        | SqlScanState::DollarQuoted(_) => {
            return Err("[IMPORT_ERROR] Unterminated string literal in SQL file".to_string());
        }
    }

    let tail = current.trim();
    if !tail.is_empty() {
        out.push(tail.to_string());
    }
    Ok(out)
}

fn parse_dollar_quote_tag(chars: &[char], start: usize) -> Option<(String, usize)> {
    if chars.get(start) != Some(&'$') {
        return None;
    }
    let mut idx = start + 1;
    while idx < chars.len() && (chars[idx].is_ascii_alphanumeric() || chars[idx] == '_') {
        idx += 1;
    }
    if idx < chars.len() && chars[idx] == '$' {
        let tag: String = chars[start..=idx].iter().collect();
        return Some((tag, idx));
    }
    None
}

fn starts_with_tag(chars: &[char], idx: usize, tag: &str) -> bool {
    let tag_chars: Vec<char> = tag.chars().collect();
    if idx + tag_chars.len() > chars.len() {
        return false;
    }
    for (offset, ch) in tag_chars.iter().enumerate() {
        if chars[idx + offset] != *ch {
            return false;
        }
    }
    true
}

fn truncate_error_message(message: &str) -> String {
    const MAX_CHARS: usize = 500;
    let mut out = String::new();
    for (idx, ch) in message.chars().enumerate() {
        if idx >= MAX_CHARS {
            out.push_str("...");
            break;
        }
        out.push(ch);
    }
    out
}

fn validate_output_path(path: &PathBuf) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("[EXPORT_ERROR] Invalid output path".to_string());
    }
    if path.file_name().is_none() {
        return Err("[EXPORT_ERROR] Output path must include a file name".to_string());
    }
    if path.exists() && path.is_dir() {
        return Err("[EXPORT_ERROR] Output path points to a directory".to_string());
    }
    Ok(())
}

fn default_output_path(base_name: &str, extension: &str) -> PathBuf {
    let home = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));
    let export_dir = home.join("Downloads").join("DbPawExports");
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    export_dir.join(format!(
        "{}_{}.{}",
        sanitize_filename(base_name),
        timestamp,
        extension
    ))
}

fn sanitize_filename(name: &str) -> String {
    let sanitized = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "export".to_string()
    } else {
        sanitized
    }
}

struct ExportWriter {
    format: ExportFormat,
    writer: BufWriter<File>,
    first_json_row: bool,
}

impl ExportWriter {
    fn new(path: PathBuf, format: ExportFormat, columns: Vec<String>) -> Result<Self, String> {
        let file =
            File::create(path).map_err(|e| format!("[EXPORT_ERROR] create file failed: {e}"))?;
        let mut writer = BufWriter::new(file);

        match format {
            ExportFormat::Csv => {
                let header = columns
                    .iter()
                    .map(|c| csv_escape(c))
                    .collect::<Vec<_>>()
                    .join(",");
                writer
                    .write_all(format!("{header}\n").as_bytes())
                    .map_err(|e| format!("[EXPORT_ERROR] write csv header failed: {e}"))?;
            }
            ExportFormat::Json => {
                writer
                    .write_all(b"[\n")
                    .map_err(|e| format!("[EXPORT_ERROR] write json header failed: {e}"))?;
            }
            ExportFormat::Sql => {}
        }

        Ok(Self {
            format,
            writer,
            first_json_row: true,
        })
    }

    fn write_rows(
        &mut self,
        rows: &[Value],
        columns: &[String],
        schema: Option<&str>,
        table: &str,
        driver: &str,
    ) -> Result<i64, String> {
        let mut count = 0;
        for row in rows {
            let obj = row
                .as_object()
                .ok_or("[EXPORT_ERROR] row is not a JSON object")?;
            self.write_row(obj, columns, schema, table, driver)?;
            count += 1;
        }
        Ok(count)
    }

    fn write_row(
        &mut self,
        row: &Map<String, Value>,
        columns: &[String],
        schema: Option<&str>,
        table: &str,
        driver: &str,
    ) -> Result<(), String> {
        match self.format {
            ExportFormat::Csv => {
                let line = columns
                    .iter()
                    .map(|c| row.get(c).map(csv_value).unwrap_or_else(|| "".to_string()))
                    .collect::<Vec<_>>()
                    .join(",");
                self.writer
                    .write_all(format!("{line}\n").as_bytes())
                    .map_err(|e| format!("[EXPORT_ERROR] write csv row failed: {e}"))?;
            }
            ExportFormat::Json => {
                if !self.first_json_row {
                    self.writer
                        .write_all(b",\n")
                        .map_err(|e| format!("[EXPORT_ERROR] write json separator failed: {e}"))?;
                }
                self.first_json_row = false;
                let text = serde_json::to_string(row)
                    .map_err(|e| format!("[EXPORT_ERROR] serialize json row failed: {e}"))?;
                self.writer
                    .write_all(text.as_bytes())
                    .map_err(|e| format!("[EXPORT_ERROR] write json row failed: {e}"))?;
            }
            ExportFormat::Sql => {
                let quoted_cols = columns
                    .iter()
                    .map(|c| quote_ident(c, driver))
                    .collect::<Vec<_>>()
                    .join(", ");
                let values = columns
                    .iter()
                    .map(|c| {
                        row.get(c)
                            .map(sql_value)
                            .unwrap_or_else(|| "NULL".to_string())
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                let statement = format!(
                    "INSERT INTO {} ({}) VALUES ({});\n",
                    quote_target(schema, table, driver),
                    quoted_cols,
                    values
                );
                self.writer
                    .write_all(statement.as_bytes())
                    .map_err(|e| format!("[EXPORT_ERROR] write sql row failed: {e}"))?;
            }
        }
        Ok(())
    }

    fn finish(&mut self) -> Result<(), String> {
        if matches!(self.format, ExportFormat::Json) {
            self.writer
                .write_all(b"\n]\n")
                .map_err(|e| format!("[EXPORT_ERROR] write json end failed: {e}"))?;
        }
        self.writer
            .flush()
            .map_err(|e| format!("[EXPORT_ERROR] flush file failed: {e}"))?;
        Ok(())
    }
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn csv_value(value: &Value) -> String {
    if value.is_null() {
        return "".to_string();
    }
    let raw = match value {
        Value::String(s) => s.clone(),
        _ => value.to_string(),
    };
    csv_escape(&raw)
}

fn sql_value(value: &Value) -> String {
    match value {
        Value::Null => "NULL".to_string(),
        Value::Bool(v) => {
            if *v {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        Value::Number(n) => n.to_string(),
        Value::String(s) => format!("'{}'", s.replace('\'', "''")),
        _ => format!("'{}'", value.to_string().replace('\'', "''")),
    }
}

fn quote_ident(name: &str, driver: &str) -> String {
    if driver.eq_ignore_ascii_case("mysql")
        || driver.eq_ignore_ascii_case("tidb")
        || driver.eq_ignore_ascii_case("mariadb")
        || driver.eq_ignore_ascii_case("clickhouse")
    {
        format!("`{}`", name.replace('`', "``"))
    } else if driver.eq_ignore_ascii_case("mssql") {
        format!("[{}]", name.replace(']', "]]"))
    } else {
        format!("\"{}\"", name.replace('"', "\"\""))
    }
}

fn quote_target(schema: Option<&str>, table: &str, driver: &str) -> String {
    let normalized_schema = schema
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|s| {
            if driver.eq_ignore_ascii_case("duckdb")
                && (s.eq_ignore_ascii_case("main") || s.eq_ignore_ascii_case("public"))
            {
                None
            } else {
                Some(s)
            }
        });

    match normalized_schema {
        Some(schema_name) => format!(
            "{}.{}",
            quote_ident(schema_name, driver),
            quote_ident(table, driver)
        ),
        None => quote_ident(table, driver),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn csv_escape_works() {
        assert_eq!(csv_escape("simple"), "simple");
        assert_eq!(csv_escape("a,b"), "\"a,b\"");
        assert_eq!(csv_escape("a\"b"), "\"a\"\"b\"");
        assert_eq!(csv_escape("a\nb"), "\"a\nb\"");
        assert_eq!(csv_escape("a,\nb"), "\"a,\nb\"");
    }

    #[test]
    fn sql_value_works() {
        assert_eq!(sql_value(&Value::Null), "NULL");
        assert_eq!(sql_value(&Value::Bool(true)), "TRUE");
        assert_eq!(
            sql_value(&Value::String("O'Reilly".to_string())),
            "'O''Reilly'"
        );
        assert_eq!(
            sql_value(&Value::Number(serde_json::Number::from(42))),
            "42"
        );
        assert_eq!(sql_value(&Value::Bool(false)), "FALSE");
    }

    #[test]
    fn quote_target_uses_schema_when_present() {
        assert_eq!(
            quote_target(Some("public"), "users", "postgres"),
            "\"public\".\"users\""
        );
        assert_eq!(
            quote_target(Some("analytics"), "events", "mysql"),
            "`analytics`.`events`"
        );
        assert_eq!(
            quote_target(Some("analytics"), "events", "tidb"),
            "`analytics`.`events`"
        );
        assert_eq!(
            quote_target(Some("analytics"), "events", "mariadb"),
            "`analytics`.`events`"
        );
        assert_eq!(
            quote_target(Some("analytics"), "events", "clickhouse"),
            "`analytics`.`events`"
        );
        assert_eq!(
            quote_target(Some("dbo"), "events", "mssql"),
            "[dbo].[events]"
        );
    }

    #[test]
    fn quote_target_ignores_empty_schema() {
        assert_eq!(quote_target(Some("  "), "users", "postgres"), "\"users\"");
        assert_eq!(quote_target(None, "users", "mysql"), "`users`");
        assert_eq!(quote_target(None, "users", "tidb"), "`users`");
        assert_eq!(quote_target(None, "users", "mariadb"), "`users`");
    }

    #[test]
    fn quote_target_uses_unqualified_main_for_duckdb() {
        assert_eq!(quote_target(Some("main"), "users", "duckdb"), "\"users\"");
        assert_eq!(
            quote_target(Some("analytics"), "events", "duckdb"),
            "\"analytics\".\"events\""
        );
    }

    #[test]
    fn quote_ident_escapes_driver_specific_chars() {
        assert_eq!(quote_ident("a`b", "mysql"), "`a``b`");
        assert_eq!(quote_ident("a`b", "clickhouse"), "`a``b`");
        assert_eq!(quote_ident("a]b", "mssql"), "[a]]b]");
        assert_eq!(quote_ident("a\"b", "postgres"), "\"a\"\"b\"");
    }

    #[test]
    fn validate_output_path_rejects_empty_path() {
        assert_eq!(
            validate_output_path(&PathBuf::new()).unwrap_err(),
            "[EXPORT_ERROR] Invalid output path"
        );
    }

    #[test]
    fn validate_output_path_rejects_directory_path() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("dbpaw-transfer-test-dir-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let err = validate_output_path(&dir).unwrap_err();
        assert_eq!(err, "[EXPORT_ERROR] Output path points to a directory");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn validate_output_path_rejects_path_without_filename() {
        let err = validate_output_path(&PathBuf::from("/")).unwrap_err();
        assert_eq!(err, "[EXPORT_ERROR] Output path must include a file name");
    }

    #[test]
    fn write_rows_rejects_non_object_rows() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("dbpaw-transfer-test-{unique}.json"));
        let mut writer =
            ExportWriter::new(path.clone(), ExportFormat::Json, vec!["a".to_string()]).unwrap();
        let err = writer
            .write_rows(
                &[Value::String("not-object".to_string())],
                &["a".to_string()],
                None,
                "t",
                "postgres",
            )
            .unwrap_err();
        assert_eq!(err, "[EXPORT_ERROR] row is not a JSON object");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn parse_sql_statements_handles_quotes_and_comments() {
        let sql = r#"
            -- comment 1
            INSERT INTO users (name, note) VALUES ('alice', 'hello;world');
            /* block comment ; ; */
            INSERT INTO users (name) VALUES ("bob");
            # mysql style comment
            INSERT INTO users(name) VALUES ($tag$semi;inside$tag$);
        "#;

        let statements = parse_sql_statements(sql, "mysql").unwrap();
        assert_eq!(statements.len(), 3);
        assert!(statements[0].starts_with("INSERT INTO users"));
        assert!(statements[1].contains("\"bob\""));
        assert!(statements[2].contains("$tag$semi;inside$tag$"));
    }

    #[test]
    fn parse_sql_statements_rejects_unterminated_block_comment() {
        let err = parse_sql_statements("INSERT INTO t VALUES (1); /*", "mysql").unwrap_err();
        assert!(err.contains("Unterminated block comment"));
    }

    #[test]
    fn parse_sql_statements_preserves_hash_for_postgres() {
        let sql = "SELECT 1 # 2;\nSELECT '#not_comment';";
        let statements = parse_sql_statements(sql, "postgres").unwrap();
        assert_eq!(statements.len(), 2);
        assert_eq!(statements[0], "SELECT 1 # 2");
        assert_eq!(statements[1], "SELECT '#not_comment'");
    }

    #[test]
    fn truncate_error_message_caps_length() {
        let source = "x".repeat(600);
        let truncated = truncate_error_message(&source);
        assert!(truncated.len() <= 503);
        assert!(truncated.ends_with("..."));
    }
}

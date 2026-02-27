use super::types::{AiPromptBundle, AiSchemaOverview, AiTableSummary, AiChatMessage};

const PROMPT_VERSION: &str = "v1.0.0";
const MAX_TABLES: usize = 8;
const MAX_COLUMNS: usize = 12;
const MAX_SCHEMA_CHARS: usize = 6000;

pub fn build_prompt_bundle(
    scenario: &str,
    input: &str,
    schema_overview: Option<&AiSchemaOverview>,
) -> AiPromptBundle {
    let selected = select_tables(input, schema_overview);
    let schema_text = render_schema_summary(&selected);

    let system = AiChatMessage {
        role: "system".to_string(),
        content: "You are an expert SQL assistant. Follow user requirements accurately, prioritize correctness, and avoid destructive statements unless explicitly requested.".to_string(),
    };

    // Many OpenAI-compatible providers only support system/user/assistant roles.
    // Keep template instructions in a second system message for compatibility.
    let developer = AiChatMessage {
        role: "system".to_string(),
        content: build_template(scenario, &schema_text),
    };

    AiPromptBundle {
        prompt_version: PROMPT_VERSION.to_string(),
        messages: vec![system, developer],
    }
}

fn build_template(scenario: &str, schema_summary: &str) -> String {
    let base_rules = "Rules:\n1. Return concise output.\n2. If scenario is sql_generate or sql_optimize, output only SQL without markdown fences.\n3. Prefer safe SQL and explain assumptions briefly only for sql_explain.";

    let scenario_rules = match scenario {
        "sql_explain" => {
            "Task: explain the SQL clearly with execution intent and optimization opportunities."
        }
        "sql_optimize" => {
            "Task: optimize the SQL for performance while keeping semantics unchanged. Return SQL only."
        }
        _ => "Task: generate SQL from natural language. Return SQL only.",
    };

    format!(
        "{base_rules}\n{scenario_rules}\n\nAvailable tables and schemas:\n{schema_summary}",
    )
}

fn select_tables(input: &str, schema_overview: Option<&AiSchemaOverview>) -> Vec<AiTableSummary> {
    let Some(overview) = schema_overview else {
        return vec![];
    };

    let tokens: Vec<String> = input
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .collect();

    let mut scored: Vec<(i32, &AiTableSummary)> = overview
        .tables
        .iter()
        .map(|t| {
            let table_name = t.name.to_lowercase();
            let mut score = 0;
            for tk in &tokens {
                if table_name.contains(tk) {
                    score += 5;
                }
                for c in &t.columns {
                    if c.name.to_lowercase().contains(tk) {
                        score += 1;
                    }
                }
            }
            (score, t)
        })
        .collect();

    scored.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.schema.cmp(&b.1.schema))
            .then_with(|| a.1.name.cmp(&b.1.name))
    });

    let mut selected = Vec::new();
    for (idx, (_, table)) in scored.iter().enumerate() {
        if idx >= MAX_TABLES {
            break;
        }
        if idx > 0 && selected.is_empty() {
            break;
        }
        if idx > 0 && scored[idx].0 <= 0 {
            continue;
        }
        selected.push((*table).clone());
    }

    if selected.is_empty() {
        selected = overview
            .tables
            .iter()
            .take(MAX_TABLES)
            .cloned()
            .collect();
    }

    selected
}

fn render_schema_summary(tables: &[AiTableSummary]) -> String {
    if tables.is_empty() {
        return "(No schema provided)".to_string();
    }

    let mut out = String::new();
    let mut rendered_tables = 0usize;
    for table in tables.iter().take(MAX_TABLES) {
        if !out.is_empty() {
            out.push('\n');
        }

        out.push_str(&format!("{}.{}\n", table.schema, table.name));

        let mut cols = Vec::new();
        let mut truncated_cols = false;
        for (idx, c) in table.columns.iter().enumerate() {
            if idx >= MAX_COLUMNS {
                truncated_cols = true;
                break;
            }
            let mut piece = format!("{} ({}", c.name, c.column_type);
            if c.nullable.unwrap_or(false) {
                piece.push_str(", nullable");
            }
            piece.push(')');
            cols.push(piece);
        }

        out.push_str("  Columns: ");
        out.push_str(&cols.join(", "));
        if truncated_cols {
            out.push_str(", ... (truncated)");
        }
        out.push('\n');

        rendered_tables += 1;
        if out.len() >= MAX_SCHEMA_CHARS {
            out.truncate(MAX_SCHEMA_CHARS);
            out.push_str("\n... (truncated)");
            return out;
        }
    }

    if tables.len() > rendered_tables {
        if out.len() + 18 < MAX_SCHEMA_CHARS {
            out.push_str("\n... (truncated)");
        } else {
            out.truncate(MAX_SCHEMA_CHARS);
            out.push_str("\n... (truncated)");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types;

    fn col(name: &str, ty: &str, nullable: Option<bool>) -> types::AiColumnSummary {
        types::AiColumnSummary {
            name: name.to_string(),
            column_type: ty.to_string(),
            nullable,
        }
    }

    fn table(schema: &str, name: &str, columns: Vec<types::AiColumnSummary>) -> AiTableSummary {
        AiTableSummary {
            schema: schema.to_string(),
            name: name.to_string(),
            columns,
        }
    }

    #[test]
    fn schema_format_matches_spec() {
        let users = table(
            "public",
            "users",
            vec![col("id", "int", Some(false)), col("email", "text", Some(true))],
        );
        let orders = table(
            "public",
            "orders",
            vec![col("id", "int", Some(false)), col("user_id", "int", Some(false))],
        );

        let out = render_schema_summary(&[users, orders]);
        assert!(out.contains("public.users\n  Columns: id (int), email (text, nullable)\n"));
        assert!(out.contains("\n\npublic.orders\n  Columns: id (int), user_id (int)\n"));
    }

    #[test]
    fn schema_truncates_columns_deterministically() {
        let mut columns = Vec::new();
        for i in 0..(MAX_COLUMNS + 3) {
            columns.push(col(&format!("c{i}"), "text", Some(true)));
        }
        let t = table("public", "wide", columns);
        let out = render_schema_summary(&[t]);
        assert!(out.contains("... (truncated)\n"));
    }

    #[test]
    fn schema_truncates_tables_deterministically() {
        let mut tables = Vec::new();
        for i in 0..(MAX_TABLES + 2) {
            tables.push(table("public", &format!("t{i}"), vec![col("id", "int", Some(false))]));
        }
        let out = render_schema_summary(&tables);
        assert!(out.contains("... (truncated)"));
    }
}

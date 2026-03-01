/**
 * Mock mode test file
 * Used to verify that each API endpoint returns data normally in Mock mode
 *
 * Usage:
 * 1. Start Mock mode: bun dev:mock
 * 2. Run test functions in this file from the browser console
 */

import { api } from "./api";

// Set log colors
const log = {
  success: (msg: string) =>
    console.log(`%c✓ ${msg}`, "color: green; font-weight: bold"),
  error: (msg: string) =>
    console.error(`%c✗ ${msg}`, "color: red; font-weight: bold"),
  info: (msg: string) =>
    console.log(`%c➜ ${msg}`, "color: blue; font-weight: bold"),
};

/**
 * Test query functionality
 */
export async function testQuery() {
  log.info("Testing query.execute...");
  try {
    const result = await api.query.execute(1, "SELECT * FROM users LIMIT 10");
    log.success(
      "query.execute returned data with " + result.rowCount + " rows",
    );
    console.log("Result:", result);
  } catch (error) {
    log.error("query.execute failed: " + (error as Error).message);
  }
}

/**
 * Test metadata functionality
 */
export async function testMetadata() {
  log.info("Testing metadata.listTables...");
  try {
    const tables = await api.metadata.listTables(1);
    log.success("metadata.listTables returned " + tables.length + " tables");
    console.log("Tables:", tables);
  } catch (error) {
    log.error("metadata.listTables failed: " + (error as Error).message);
  }

  log.info("Testing metadata.getTableStructure...");
  try {
    const structure = await api.metadata.getTableStructure(
      1,
      "public",
      "users",
    );
    log.success(
      "metadata.getTableStructure returned " +
        structure.columns.length +
        " columns",
    );
    console.log("Structure:", structure);
  } catch (error) {
    log.error("metadata.getTableStructure failed: " + (error as Error).message);
  }

  log.info("Testing metadata.getTableMetadata...");
  try {
    const metadata = await api.metadata.getTableMetadata(
      1,
      undefined,
      "public",
      "users",
    );
    log.success(
      "metadata.getTableMetadata returned " +
        metadata.columns.length +
        " columns",
    );
    console.log("Metadata:", metadata);
  } catch (error) {
    log.error("metadata.getTableMetadata failed: " + (error as Error).message);
  }

  log.info("Testing metadata.getSchemaOverview...");
  try {
    const overview = await api.metadata.getSchemaOverview(1);
    log.success(
      "metadata.getSchemaOverview returned " +
        overview.tables.length +
        " tables",
    );
    console.log("Overview:", overview);
  } catch (error) {
    log.error("metadata.getSchemaOverview failed: " + (error as Error).message);
  }
}

/**
 * Test table data functionality
 */
export async function testTableData() {
  log.info("Testing tableData.get...");
  try {
    const data = await api.tableData.get({
      id: 1,
      schema: "public",
      table: "users",
      page: 1,
      limit: 10,
    });
    log.success("tableData.get returned " + data.data.length + " rows");
    console.log("Data:", data);
  } catch (error) {
    log.error("tableData.get failed: " + (error as Error).message);
  }
}

/**
 * Test connections functionality
 */
export async function testConnections() {
  log.info("Testing connections.list...");
  try {
    const connections = await api.connections.list();
    log.success(
      "connections.list returned " + connections.length + " connections",
    );
    console.log("Connections:", connections);
  } catch (error) {
    log.error("connections.list failed: " + (error as Error).message);
  }
}

/**
 * Run all tests
 */
export async function runAllTests() {
  console.log(
    "%c========== Mock API Tests Starting ==========",
    "color: purple; font-weight: bold; font-size: 14px",
  );

  await testQuery();
  console.log("");

  await testMetadata();
  console.log("");

  await testTableData();
  console.log("");

  await testConnections();

  console.log(
    "%c========== Mock API Tests Ended ==========",
    "color: purple; font-weight: bold; font-size: 14px",
  );
}

// Export test functions for easy calling from browser console
if (typeof window !== "undefined") {
  (window as any).testMockAPI = {
    runAllTests,
    testQuery,
    testMetadata,
    testTableData,
    testConnections,
  };
}

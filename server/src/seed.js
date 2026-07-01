import { pool, runInitMigration, runSqlFile } from "./db.js";

async function runSeed() {
  await runInitMigration();
  await runSqlFile("migrations/002_seed_sample_data.sql");

  console.log("Seed complete: sample rows inserted/updated.");
}

runSeed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

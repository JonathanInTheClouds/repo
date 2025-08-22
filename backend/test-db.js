import pkg from "pg";
const { Client } = pkg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // DigitalOcean requires SSL
});

async function main() {
  try {
    await client.connect();
    console.log("✅ Connected to Postgres!");
    const res = await client.query("SELECT NOW()");
    console.log("Server time is:", res.rows[0].now);
  } catch (err) {
    console.error("❌ Database connection failed:", err);
  } finally {
    await client.end();
  }
}

main();

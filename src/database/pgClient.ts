import { Client } from "pg";
import type { ClientConfig } from "pg";

const pgClient = () => {
  const configuration: ClientConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "5432", 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };

  return new Client(configuration);
};

export default pgClient;
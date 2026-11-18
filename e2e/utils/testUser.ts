import fs from "node:fs";

export type TestUser = {
  email: string;
  password: string;
  username?: string;
};

const credentialsUrl = new URL("../.auth/credentials.json", import.meta.url);

export const getTestUser = (): TestUser => {
  const raw = fs.readFileSync(credentialsUrl, "utf-8");
  return JSON.parse(raw) as TestUser;
};

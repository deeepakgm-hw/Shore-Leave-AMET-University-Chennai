export interface User {
  id: string;
  roll?: string;
  username?: string;
  name: string;
  role: "admin" | "officer" | "cadet";
}
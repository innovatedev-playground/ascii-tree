import { defineConfig } from "vite";
import { fresh } from "fresh/vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [fresh(), tailwindcss()],
});

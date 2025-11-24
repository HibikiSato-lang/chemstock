/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "node_modules/flowbite/**/*.{js,ts}",
  ],
  theme: {
  extend: {
    borderColor: {
      border: "hsl(var(--border))",
    },
    backgroundColor: {
      background: "hsl(var(--background))",
    },
    textColor: {
      foreground: "hsl(var(--foreground))",
    },
  },
  },
  plugins: [],
}

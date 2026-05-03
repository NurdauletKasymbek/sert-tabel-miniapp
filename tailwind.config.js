export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        void: "#0A0A0A",
        neon: "#7DF9FF",
        ion: "#D6FF6B",
        flare: "#FF4FD8",
      },
      boxShadow: {
        neon: "0 0 32px rgba(125, 249, 255, 0.28)",
        glass: "0 24px 70px rgba(0, 0, 0, 0.35)",
      },
    },
  },
  plugins: [],
};

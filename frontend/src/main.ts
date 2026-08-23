import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { initTheme } from "@/lib/theme";
import { initHotkeys } from "@/lib/hotkeys";
import "@/styles/main.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);

initTheme();
initHotkeys();

app.mount("#app");

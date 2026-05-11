import './assets/styles/main.scss'

import { createApp } from 'vue'

import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';

import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'

import VueVirtualScroller from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'

import App from './App.vue'
import router from './router'

const app = createApp(App)

const pinia = createPinia();
pinia.use(piniaPluginPersistedstate); // 注册持久化插件

app.use(pinia)
app.use(router)
app.use(ElementPlus)
app.use(VueVirtualScroller)
app.mount('#app')

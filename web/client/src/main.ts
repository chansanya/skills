import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

const app = createApp(App)

app.config.errorHandler = (err) => {
  console.error('Skills App Error:', err)
}

app.mount('#app')

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import AssistantChat from './components/AssistantChat.jsx'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <AssistantChat />
  </React.StrictMode>
)

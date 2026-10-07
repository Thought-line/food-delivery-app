import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

// This is the app's real entry point — it finds the <div id="root"> in
// index.html and mounts the whole React app inside it.
// BrowserRouter enables page navigation (routes) without full page reloads.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RoomProvider } from './context/RoomContext'
import { ThemeProvider } from './context/ThemeContext'
import { HomePage } from './pages/HomePage'
import { RoomPage } from './pages/RoomPage'

export default function App() {
  return (
    <ThemeProvider>
      <RoomProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/room/:code" element={<RoomPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </RoomProvider>
    </ThemeProvider>
  )
}

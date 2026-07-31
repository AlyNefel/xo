import './globals.css'

export const metadata = {
  title: 'Neon XO Multiplayer',
  description: 'A beautiful real-time Tic-Tac-Toe experience built with Next.js',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet" />
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}

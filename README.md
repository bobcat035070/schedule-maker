# Schedule Maker 📅

A fast, client-side web application that reads student registration PDFs and automatically generates a clean, visually appealing weekly class schedule.

## Features ✨

* **Accurate PDF Parsing:** Utilizes `pdfjs-dist` to extract text using exact spatial (X/Y) coordinates, ensuring reliable extraction of course codes, times, and titles—even from complex table layouts.
* **Smart Canvas Rendering:** Built with HTML5 Canvas to perfectly plot out the weekly grid. It automatically handles overlapping classes by placing them side-by-side and dynamically resizes text so that even short 1-hour blocks remain readable.
* **Privacy First:** Everything runs locally in your browser. No PDFs or personal schedule data are ever uploaded to a server.
* **One-Click Export:** Download your generated schedule as a high-quality PNG image, ready to be used as a wallpaper or shared with friends.

## Tech Stack 🛠️

* **Framework:** [React](https://reactjs.org/) + [Vite](https://vitejs.dev/)
* **PDF Processing:** [PDF.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`)
* **Rendering:** HTML5 Canvas API
* **Styling:** Custom CSS3 with modern UI principles

## How to Run Locally 🚀

1. **Clone the repository:**
   ```bash
   git clone https://github.com/bobcat035070/schedule-maker.git
   cd schedule-maker
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Start the development server:**
   ```bash
   npm run dev
   ```
4. Open the local link provided in your terminal (usually `http://localhost:5173/`) and upload your PDF!

# 🖥️ ScreenSwitching: Easy Setup & User Guide

Welcome to **ScreenSwitching**! This is a professional, OBS-style multi-screen media presentation and switching system. It allows you to project videos, images, playlists, text overlays, and even live desktop applications onto a secondary display (like a TV or projector) while managing everything in real-time from a Control Panel on your laptop, tablet, or smartphone.

This guide is designed for **non-programmers** to help you set up, run, and master this program from scratch. No prior coding experience is required!

---

## 📋 Table of Contents
1. [Step 1: Installing Node.js (The Engine)](#step-1-installing-nodejs-the-engine)
2. [Step 2: Installing the Program Files](#step-2-installing-the-program-files)
3. [Step 3: Running the Program](#step-3-running-the-program)
4. [Step 4: Accessing the Control Panel & Display Screen](#step-4-accessing-the-control-panel--display-screen)
5. [Step 5: Managing Events, Scenes, and Media](#step-5-managing-events-scenes-and-media)
6. [Step 6: Live Screen Sharing (Casting)](#step-6-live-screen-sharing-casting)
7. [🔒 Enabling Local Network Screen Share (Chrome / Edge)](#-enabling-local-network-screen-share-chrome--edge)
8. [⚠️ Important Limitations & Best Practices](#️-important-limitations--best-practices)

---

## Step 1: Installing Node.js (The Engine)

Before running the program, you need to install a helper program called **Node.js**. Node.js acts as a mini-server on your computer that processes files and enables your browser to communicate with your screens.

### 🪟 Windows Setup
1. Visit the official Node.js website: **[https://nodejs.org](https://nodejs.org)**.
2. Click on the button labeled **LTS** (Long-Term Support) to download the installer (e.g., `node-v20.xx.x-x64.msi`).
3. Open the downloaded file to start the installation wizard.
4. Click **Next** on all prompts. Keep the default settings.
5. **Crucial:** Make sure the option **"Add to PATH"** remains checked if prompted.
6. Click **Install**, and then click **Finish** when complete.

### 🍎 macOS Setup
1. Go to **[https://nodejs.org](https://nodejs.org)**.
2. Click the **LTS** button to download the macOS installer (a `.pkg` file).
3. Double-click the downloaded file in your downloads folder and follow the instructions.
4. Click **Continue**, agree to the terms, and click **Install**.
5. Enter your Mac password when prompted, then close the installer when done.

### 🐧 Linux Setup (Ubuntu / Debian / Mint)
If you are running Linux, open your terminal (Ctrl + Alt + T) and type the following commands:
```bash
sudo apt update
sudo apt install -y nodejs npm
```

### 🔍 How to verify it is installed correctly:
Open your command line tool (called **Command Prompt** on Windows, **Terminal** on Mac/Linux) and run the following command:
```bash
node -v
```
If a version number (like `v20.11.0`) appears on the screen, Node.js was installed successfully!

---

## Step 2: Installing the Program Files

Now, let's download the specific codes and packages that make **ScreenSwitching** work.

1. **Locate the project folder** (the folder where this `how_to_setup_and_use.md` file is located).
2. **Open the command line inside this folder:**
   * **Windows:** Open the folder in File Explorer. Click on the folder address bar at the very top of the window, type `cmd`, and press **Enter**.
   * **macOS:** Right-click the folder icon, hover over **Services** (or **Folder Options**), and click **New Terminal at Folder**.
   * **Linux:** Right-click anywhere in the folder background and click **Open in Terminal**.
3. Type the following command and press **Enter**:
   ```bash
   npm install
   ```
   > ℹ️ **What is this doing?** This command instructs your computer to fetch and install all the extra parts needed for the server (like Socket.io for instant syncing, Express for the web-host, etc.). You only need to run this command **once** when you first install the program.

---

## Step 3: Running the Program

Whenever you want to use the program, follow these simple steps:

1. Open your command line inside the project folder (as you did in Step 2).
2. Type the following command and press **Enter**:
   ```bash
   npm start
   ```
3. Look closely at the terminal window. A few seconds after running this, you will see:
   * A large **QR Code** directly in the console.
   * Information indicating the server is running on **Port 3001**.
   * A list of web addresses (URLs).

Keep this terminal window open! Closing it will turn off the program server.

---

## Step 4: Accessing the Control Panel & Display Screen

### 🎛️ 1. Opening the Control Panel
The **Control Panel** is the cockpit where you trigger files, play playlists, type text overlays, and adjust volume.
* **On the same host computer:** Open Google Chrome or Microsoft Edge and navigate to:
  👉 **[http://localhost:3001/control.html](http://localhost:3001/control.html)**
* **From a Smartphone, Tablet, or another Laptop:**
  * Connect the device to the **same Wi-Fi network** as the host computer.
  * Either **scan the QR code** printed in the terminal with your device's camera, OR
  * Enter the local network address listed in the terminal (e.g. `http://192.168.1.15:3001/control.html`) into your device's mobile web browser.

---

### 📺 2. Opening the Display Screen (The Showing Screen)
The **Display Screen** is the output window that you project to your audience (usually placed on a TV, projector, or second monitor).

You can open this showing window in two ways:
1. **The Automatic Dual-Screen split button (Recommended):**
   * On the top right of the Control Panel, you will see an **"Open Showing Screen"** button.
   * Next to it, click the small drop-down arrow.
   * If you have a second monitor or TV connected, you will see a list of connected screens!
   * Select your secondary monitor (e.g. **Display 2**).
   * **The Magic:** The browser will automatically open the display window, place it directly on that second screen, and force it into **true native borderless fullscreen** (completely hiding browser address bars and borders)!
2. **The Manual Method (Fallback):**
   * If you only have one screen, or if the automatic feature is blocked, click the main **"Open Showing Screen"** button.
   * A popup window will launch. Drag this window over to your secondary screen/TV, and then click the **Fullscreen** button on the bottom of that window.

> 🚨 **Pop-up Blocker Warning:** The first time you click "Open Showing Screen", your browser will block it as a popup. Look at the right-hand side of your browser's address bar for an icon with a red `x` or "Pop-up Blocked" alert. Click it, select **"Always allow pop-ups and redirects from http://..."**, click **Done**, and click the button again.

---

## Step 5: Managing Events, Scenes, and Media

The system is organized to handle complex events sequentially, similar to PowerPoint or OBS Studio:

### 📁 1. Events (Collections)
Think of an **Event** as a folder for your show (e.g., "Annual Gala 2026", "Wedding Playlist").
* You can create, rename, and duplicate whole events with their assets.
* Duplicate an event if you want to use it as a template for a new show.
* You can right-click (or long-tap on mobile) an Event tab to access a context menu to **Rename**, **Duplicate**, or **Delete** the event.

### 🎭 2. Scenes
Under each Event, you create **Scenes** (e.g., "Welcome Slide", "Intro Video", "Sponsor Logos").
* Triggering a scene immediately pushes all the files in that scene onto the projected screen.
* Right-click (or long-tap on mobile) any Scene in the list to **Rename**, **Duplicate**, or **Delete** it.

### 🖼️ 3. Adding Media Sources
Select a scene, click the **Add Source** button, and choose what to display:
* **Upload Media File:** Upload images (PNG, JPG, GIF), videos (MP4, WebM), or background audio (MP3, WAV).
  * **Duplicate File Warning:** If you upload a file with a filename that already exists in your Event library, a yellow banner will warn you. You can choose to **Overwrite** (replace the old file) or **Keep Both** (save the new file as a duplicate).
* **Make Playlist:** Check the **"Make Playlist"** box when uploading multiple files at once.
  * You can set transition effects between slides.
  * Set a default duration for images.
  * **Interactive Sorting:** Drag and drop items up and down the list in the upload panel to arrange them in the exact order you want before submitting!
* **Select Existing Library Asset:** Click this to reuse a file you've already uploaded to this Event without having to upload it again.
* **Text Overlay:** Create beautiful styled text (captions, announcements, lower thirds) that floats over your media.
  * **Upload Custom Fonts:** Inside the text overlay settings, you can upload any custom font file (`.ttf` or `.otf`) from your computer. The system automatically registers it and displays it perfectly on both the control panel preview and the TV projector screen!

### 🎚️ 4. Real-Time Layer Controls
For every media layer you place in a scene, you can control it live:
* **Position & Scale:** Slide the controls to make a video smaller, move it to the corner, or stretch it.
* **Volume:** Adjust the slider to quiet down background music or blast a video.
* **Looping:** Toggle loop on/off for videos and background tracks.
* **Visibility:** Click the "eye" icon to instantly hide or show a layer without deleting it.
* **Text Edits:** Click on a text source to change its words live, and see the update render instantly on the big screen!

---

## Step 6: Live Screen Sharing (Casting)

This is one of the most powerful features of **ScreenSwitching**. You can stream any open application (like a PowerPoint presentation window, a Canva browser tab, or an Excel document) directly into your scenes in real-time, complete with audio!

### 🚀 How to Share a Screen:
1. In the Control Panel, select a scene and click **Add Source**.
2. Select **"Cast Application Window (WebRTC)"**.
3. Type a descriptive name so you can identify it (e.g., "PowerPoint Slides") and click **OK**.
4. A secure system window will pop up asking what you want to share. You have three choices:
   * **Chrome/Edge Tab:** Best for streaming an online tool like Google Slides or Canva.
   * **Window:** Best for streaming a desktop app like PowerPoint, Keynote, or VLC.
   * **Entire Screen:** Casts everything on one of your monitors.
5. Check the box labeled **"Share system audio"** at the bottom-left of the popup if your presentation includes sound/video.
6. Click the blue **Share** button.
7. The application will start streaming in real-time onto your screen!
8. **To Stop Casting:** Click the native **"Stop sharing"** button in the floating blue bar at the bottom of your screen, or delete/hide the WebRTC source in your Control Panel.

---

## 🔒 Enabling Local Network Screen Share (Chrome / Edge)

Due to modern web browser security restrictions, advanced features like **Screen Sharing (WebRTC)** are blocked on normal, unencrypted internet pages (`http://`). The browser only allows these on "Secure Contexts" (websites using `https://` or running directly on `localhost`).

If you are using the Control Panel **on the host computer**, it is running on `http://localhost:3001/control.html` which is secure, and screen sharing will work automatically!

However, **if you are using a second computer on the same Wi-Fi** (e.g., `http://192.168.1.15:3001/control.html`), the browser will block screen sharing and show a red **"Secure Context Required!"** error.

### 🛠️ The Fix for Chrome or Edge (Takes 1 Minute)
You can tell your browser to trust your local network address as a secure origin:

1. Open a new tab in Google Chrome or Microsoft Edge on the computer you want to cast from.
2. In the URL address bar, type one of the following and press **Enter**:
   * **Google Chrome:** `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
   * **Microsoft Edge:** `edge://flags/#unsafely-treat-insecure-origin-as-secure`
3. Locate the setting at the top named **"Insecure origins treated as secure"**.
4. Change the dropdown menu next to it from **Disabled** to **Enabled**.
5. In the large text box provided, enter your server's network address exactly as shown in the terminal, for example:
   ```text
   http://192.168.1.15:3001
   ```
   *(Be sure to replace `192.168.1.15` with the actual network IP address shown in your terminal!)*
6. Click the blue **Relaunch** button at the bottom-right corner of the browser window.
7. Go back to your Control Panel webpage. You can now use the **"Cast Application Window (WebRTC)"** button perfectly on your local network!

---

## ⚠️ Important Limitations & Best Practices

Please keep these browser behaviors in mind to ensure a flawless presentation:

### 🛡️ 1. Pop-up & Display Screen Permissions
* **Window Management:** The automatic screen detection split-button relies on the browser's "Window Management API". When you first use it, the browser will ask: *"Allow http://localhost:3001 to manage windows on all your displays?"*. **You must click "Allow"**, otherwise the program cannot detect where your second monitor is!
* **Pop-ups:** As mentioned in Step 4, always whitelist popups for the server URL in your browser settings.

### 🔇 2. Browser Audio Auto-Play Policy
To prevent websites from playing annoying ads with sound, web browsers block *all* web pages from playing audio automatically until a user clicks on the page.
* **The Symptom:** You play a video or audio file on the Control Panel, but no sound plays on the projected TV/Projector screen.
* **The Solution:** After the Display Screen window opens on your TV or projector, **click anywhere on that display window once** with your mouse. This signals to the browser that you want to interact with the page, and all subsequent videos/audios will play sound automatically!

### 🎬 3. Supported File Formats
The program can only play media files that the browser (Chrome/Edge) natively supports:
* **Images:** `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`.
* **Videos:** `.mp4` (encoded in standard H.264/AAC), `.webm`.
  * *Note:* High-end professional files like Apple ProRes, raw formats, or `.mkv` files will not play or will drop frames. Always convert your presentation videos to standard MP4 before uploading!
* **Audios:** `.mp3`, `.wav`, `.ogg`, `.m4a`.

### 📶 4. Network Performance (Wi-Fi Quality)
* Playing uploaded files (images/videos) is extremely fast and light because they are loaded directly from the host computer's hard drive.
* **Screen Sharing (Casting)** streams high-definition video over your local Wi-Fi in real-time. If your router is weak or located far away, you may experience dropped frames or quality degradation. For heavy presentation setups, we recommend using a wired Ethernet connection or placing your Wi-Fi router close to your presentation laptops.

### 🗑️ 5. Deleting Events & Data
* When you delete an Event, **all physical files** uploaded for that Event are permanently deleted from your computer's hard disk (`uploads` folder). Make sure to keep backup copies of important media files elsewhere on your computer!

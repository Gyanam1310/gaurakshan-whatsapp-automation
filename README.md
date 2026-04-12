# 🚀 WhatsApp Donation Automation System

A full-stack automation system that allows users to submit donation details via a web interface, stores data in Google Sheets, and automatically sends formatted WhatsApp messages daily using n8n workflows.

---

## 🌟 Features

* 📱 **Mobile-friendly frontend** for easy usage
* 🧾 **Google Sheets integration** for data storage
* 🤖 **Automated WhatsApp messaging** using backend API
* ⏰ **Scheduled automation (daily at 7 AM)** using n8n
* 🐳 **Dockerized setup** for easy deployment
* 🖼️ **Google Drive image integration** with fallback handling
* 🔁 **Idempotent messaging system** (prevents duplicate sends)

---

## 🏗️ Architecture

```
Frontend (HTML/CSS/JS)
        ↓
Backend API (Node.js)
        ↓
Google Sheets (Data Storage)
        ↓
n8n Workflow (Scheduler)
        ↓
WhatsApp Message Sender
```

---

## ⚙️ Tech Stack

* **Frontend:** HTML, CSS, JavaScript
* **Backend:** Node.js, Express.js
* **Automation:** n8n
* **Database:** Google Sheets
* **Queue (optional):** Redis + BullMQ
* **Containerization:** Docker & Docker Compose

---

## 📂 Project Structure

```
whatsapp-automation/
│
├── frontend/          # UI (HTML, CSS, JS)
├── backend/           # Node.js API
├── docker-compose.yml
├── .env
└── README.md
```

---

## 🚀 Getting Started (Local Setup)

### 1️⃣ Clone the repository

```
git clone https://github.com/your-username/whatsapp-automation.git
cd whatsapp-automation
```

---

### 2️⃣ Add environment variables

Create a `.env` file in root:

```
PORT=5000
GOOGLE_SHEETS_ID=your_sheet_id
GOOGLE_SERVICE_ACCOUNT=your_service_account_json
```

---

### 3️⃣ Run with Docker

```
docker compose up -d
```

---

### 4️⃣ Access services

* 🌐 Frontend → http://localhost:8080
* 🔧 Backend → http://localhost:5000
* 🔄 n8n → http://localhost:5678

---

## 🔄 Workflow Logic (n8n)

* Trigger: **Daily at 7:00 AM**
* Fetch rows from Google Sheets
* Filter rows for today's date
* Send WhatsApp message via backend API
* Mark row as **sent**

---

## 🧠 Key Concepts

* **Idempotency:** Prevents duplicate message sending
* **Automation:** Fully hands-free daily execution
* **Separation of concerns:** Frontend, backend, and workflow are independent

---

## ⚠️ Important Notes

* Ensure Google Drive images are publicly accessible
* Keep `.env` and service account credentials secure
* Do not push sensitive files to GitHub

---

## 🐳 Docker Commands

Start services:

```
docker compose up -d
```

Rebuild after changes:

```
docker compose up --build -d
```

Stop services:

```
docker compose down
```

---

## 🚀 Deployment

Recommended: Deploy on a VPS (DigitalOcean / AWS / Hostinger)

Steps:

1. Setup server
2. Install Docker
3. Clone repo
4. Run `docker compose up -d`

---

## 📈 Future Improvements

* Retry mechanism for failed messages
* Admin dashboard
* Authentication system
* Cloud image storage (Cloudinary / S3)
* Logging & monitoring

---

## 👨‍💻 Author

**Gyanam Bhalgat**
🔗 GitHub: https://github.com/Gyanam1310
🔗 LinkedIn: https://linkedin.com/in/gyanam-bhalgat

---

## ⭐ Support

If you found this project useful, consider giving it a ⭐ on GitHub!

---

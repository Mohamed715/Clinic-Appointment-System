# 🏥 Clinic Appointment System

**A full-stack web app for booking, managing and tracking clinic appointments.**

---

## 📖 About

Clinic Appointment System lets patients book visits online and gives clinic staff one place to manage schedules. Doctors set their available times, patients book into those slots, and staff approve, transfer or postpone appointments. Every important action is recorded in a system log.

---

## ✨ Features

### 👤 Patients
- 📝 Sign up and log in
- 📅 Book, reschedule and cancel their own appointments
- 🔔 Get notifications when a booking is **approved**, **rejected** or **transferred**

### 🩺 Doctors
- 🕒 Set available time slots
- ✅ Approve or ❌ reject bookings
- 🔄 Transfer an appointment to another doctor
- 🏷️ Mark visits as **visited** or **completed**

### 🧾 Receptionists
- 📋 Manage daily appointments
- 🔄 Transfer appointments to another doctor
- ⏸️ Postpone appointments

### 🛡️ Clinic Manager (Admin)
- 👥 Manage users and roles
- 🔄 Transfer and ⏸️ postpone appointments
- 📜 View the full system log

### ⚙️ System
- 🔐 Role-based access using Django permissions
- 📜 System log of user actions
- ⚠️ Confirm dialogs before deleting records or leaving a page

---

## 🔄 Appointment Status Flow

```
Pending ──► Approved ──► Visited ──► Completed
   │           │
   │           ├──► Transferred (to another doctor)
   │           └──► Postponed
   └──► Rejected / Cancelled
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| 🎨 Frontend | React + TypeScript (Node.js) |
| ⚙️ Backend | Django + Django REST Framework |
| 🗄️ Database | MySQL |
| 🔐 Access control | Django permissions & groups |

---

## 📁 Project Structure

```
clinic/
├── backend/        # Django REST Framework API
└── frontend/       # React + TypeScript app
```

---

## 🚀 Getting Started

### ✅ Prerequisites
- 🐍 Python 3.10+
- 🟢 Node.js 18+ and npm
- 🐬 MySQL 8+

### 1️⃣ Clone the repository
```bash
git clone https://github.com/<your-username>/<repo-name>.git
cd <repo-name>
```

### 2️⃣ Create the MySQL database
```sql
CREATE DATABASE clinic_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 3️⃣ Set up the backend
```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
```

Update the database settings (in `settings.py` or your `.env` file):
```python
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.mysql",
        "NAME": "clinic_db",
        "USER": "root",
        "PASSWORD": "your_password",
        "HOST": "localhost",
        "PORT": "3306",
    }
}
```

Run migrations, create an admin user and start the server:
```bash
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```
🌐 API runs at `http://127.0.0.1:8000`

### 4️⃣ Set up the frontend
```bash
cd ../frontend
npm install
npm start
```
🌐 App runs at `http://localhost:3000`

---

## 👥 User Roles

| Role | Book | Approve / Reject | Transfer | Postpone | Manage Users | View Logs |
|------|:----:|:----------------:|:--------:|:--------:|:------------:|:---------:|
| 🛡️ Manager | – | – | ✅ | ✅ | ✅ | ✅ |
| 🧾 Receptionist | – | – | ✅ | ✅ | – | – |
| 🩺 Doctor | – | ✅ | ✅ | – | – | – |
| 👤 Patient | ✅ | – | – | – | – | – |

---

## 🤝 Contributing

1. 🍴 Fork the repo
2. 🌿 Create a branch: `git checkout -b feature/your-feature`
3. 💾 Commit: `git commit -m "Add your feature"`
4. 📤 Push: `git push origin feature/your-feature`
5. 🔃 Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License.

---

⭐ If you find this project useful, give it a star!

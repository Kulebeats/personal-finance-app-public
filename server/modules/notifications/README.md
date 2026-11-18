# Notifications Module

User notification management.

## Endpoints

| Method | Path           | Description        |
| ------ | -------------- | ------------------ |
| GET    | /              | List notifications |
| GET    | /unread-count  | Get count          |
| POST   | /mark-read     | Mark specific      |
| POST   | /mark-all-read | Mark all           |
| DELETE | /:id           | Delete one         |

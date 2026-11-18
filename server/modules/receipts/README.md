# Receipts Module

Receipt upload, OCR processing, and transaction matching.

## Endpoints

| Method | Path                    | Description                     |
| ------ | ----------------------- | ------------------------------- |
| GET    | /                       | List pending receipts           |
| GET    | /:id                    | Get receipt by ID               |
| POST   | /upload                 | Upload receipt image            |
| POST   | /:id/match              | Match to transaction            |
| POST   | /:id/ocr-results        | Store OCR results               |
| POST   | /:id/create-transaction | Create transaction from receipt |
| DELETE | /:id                    | Delete receipt                  |

# Household Module

Household settings and member management.

## Endpoints

| Method | Path                  | Description               |
| ------ | --------------------- | ------------------------- |
| GET    | /general              | Get household settings    |
| POST   | /                     | Create household          |
| PUT    | /general              | Update household settings |
| GET    | /members              | List household members    |
| PUT    | /members/:userId/role | Update member role        |
| DELETE | /members/:userId      | Remove member             |
| POST   | /invite               | Invite new member         |

# Categories Module

Category groups and categories management.

## Endpoints

### Groups

| Method | Path                | Auth   |
| ------ | ------------------- | ------ |
| GET    | /groups             | all    |
| POST   | /groups             | member |
| PUT    | /groups/:id         | member |
| DELETE | /groups/:id         | member |
| PUT    | /groups/:id/restore | member |

### Categories

| Method | Path         | Auth   |
| ------ | ------------ | ------ |
| GET    | /            | all    |
| GET    | /:id         | all    |
| POST   | /            | member |
| PUT    | /:id         | member |
| DELETE | /:id         | member |
| PUT    | /:id/restore | member |

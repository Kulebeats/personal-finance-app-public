# Tags Module

Tags management and transaction tagging.

## Endpoints

| Method | Path                    | Auth   |
| ------ | ----------------------- | ------ |
| GET    | /                       | all    |
| GET    | /:id                    | all    |
| POST   | /                       | member |
| PUT    | /:id                    | member |
| DELETE | /:id                    | member |
| GET    | /transaction/:id        | all    |
| POST   | /transaction/:id        | member |
| DELETE | /transaction/:id/:tagId | member |

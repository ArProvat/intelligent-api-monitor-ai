# Intelligent API Monitor AI - API Documentation

Refer to the complete backend API documentation in:
- [Backend API Specification](backend/docs/api.md)

---

## Quick Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Health check & database readiness |
| `POST` | `/monitor` | Ingest batch of API observations (1–100 items) |
| `GET` | `/alerts` | Query/filter paginated alerts |
| `GET` | `/alerts/:id` | Get alert details |
| `PATCH` | `/alerts/:id/resolve` | Mark alert as resolved |

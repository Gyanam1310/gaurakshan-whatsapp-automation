# n8n Assets

- Place workflow export files in `n8n/workflows` if you want versioned workflow JSONs.
- Persistent runtime data is stored in the Docker volume `n8n-data`.
- Inside n8n HTTP Request nodes, use `{{$env.BACKEND_BASE_URL}}/send-message` (or `/save-donation`) to avoid localhost issues.

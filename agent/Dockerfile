FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# "start" runs the worker in production mode (connects and waits for job
# dispatch, no local dev conveniences). Use "dev" locally instead — see
# agent/README.md.
CMD ["python", "-m", "src.entrypoint", "start"]

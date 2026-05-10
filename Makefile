.PHONY: stop clean-chrome start start-bg restart

# Stop our server and clean up orphan Chrome processes
stop: clean-chrome
	@echo "Stopping server..."
	@-pkill -f "tsx.*server\.ts" 2>/dev/null || true
	@-pkill -f "npm run dev" 2>/dev/null || true
	@echo "Done."

# Kill orphan Chrome/Chromium headless processes
clean-chrome:
	@echo "Cleaning orphan Chrome processes..."
	@-pkill chrome-headless 2>/dev/null || true
	@-pkill chromium_headless 2>/dev/null || true

# Start the server (stops any existing instance first)
# Logs stream to terminal. Use `make start-bg` to run in background.
start: stop
	@echo "Starting server on port 3000..."
	@npm run dev

# Start the server in the background
start-bg: stop
	@echo "Starting server on port 3000 (background)..."
	@nohup npm run dev > server.log 2>&1 &
	@echo "PID $$! — logs at server.log"

# Restart: stop + start
restart: stop start

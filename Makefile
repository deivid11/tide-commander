# Tide Commander Makefile
# Common commands for development and builds

.PHONY: dev build clean install lint test apk apk-release apk-release-nondev dev-apk sync help landing dev-landing deploy-landing tc

# Default target
help:
	@echo "Tide Commander - Available commands:"
	@echo ""
	@echo "  Development:"
	@echo "    make dev          - Start development server (client + backend)"
	@echo "    make dev-client   - Start only the client dev server"
	@echo "    make dev-server   - Start only the backend server"
	@echo ""
	@echo "  Build:"
	@echo "    make build        - Build the web application"
	@echo "    make landing      - Build landing page for S3 deploy"
	@echo "    make dev-landing  - Start landing page dev server"
	@echo "    make deploy-landing - Run landing deploy script"
	@echo "    make clean        - Clean build artifacts"
	@echo "    make lint         - Run TypeScript type checking"
	@echo "    make test         - Run tests"
	@echo ""
	@echo "  Android:"
	@echo "    make apk          - Build debug APK"
	@echo "    make apk-release  - Build release APK"
	@echo "    make apk-release-nondev - Build non-dev debug APK"
	@echo "    make dev-apk      - Build debug APK with CAP_SERVER_URL"
	@echo "    make sync         - Sync web assets to Android"
	@echo "    make android      - Full build + open Android Studio"
	@echo ""
	@echo "  CLI:"
	@echo "    make tc           - Run CLI client (use ARGS= for arguments)"
	@echo ""
	@echo "  Setup:"
	@echo "    make install      - Install dependencies"
	@echo "    make setup        - Run initial setup"

# Development
dev:
	npm run dev

dev-client:
	npm run dev:client

dev-server:
	npm run dev:server

# Build
build:
	npm run build

landing:
	npx vite build --config vite.app-static.config.ts
	npx vite build --config vite.landing.config.ts
	@echo ""
	@echo "Landing page built to dist-landing/"
	@echo "App included at dist-landing/app/"
	@echo "Ready to upload to S3"

dev-landing:
	npx vite --config vite.landing.config.ts

deploy-landing:
	./deploy-landing.sh

clean:
	rm -rf dist
	rm -rf dist-app
	rm -rf dist-landing
	rm -rf android/app/build
	rm -rf node_modules/.vite

lint:
	npm run lint

test:
	npm run test

# Android
sync:
	npm run build
	npx cap sync android

apk: sync
	cd android && ./gradlew assembleDebug
	@echo ""
	@echo "APK built successfully!"
	@echo "Location: android/app/build/outputs/apk/debug/app-debug.apk"

apk-release: sync
	cd android && ./gradlew assembleRelease
	@echo ""
	@echo "Release APK built!"
	@echo "Location: android/app/build/outputs/apk/release/app-release-unsigned.apk"

apk-release-nondev:
	CAP_SERVER_URL= npm run build
	CAP_SERVER_URL= npx cap sync android
	cd android && ./gradlew assembleDebug
	@echo ""
	@echo "Non-dev debug APK built with bundled assets"
	@echo "Location: android/app/build/outputs/apk/debug/app-debug.apk"

dev-apk:
	@if [ -z "$(CAP_SERVER_URL)" ]; then \
		echo "CAP_SERVER_URL is required"; \
		echo "Usage: make dev-apk CAP_SERVER_URL=http://<your-ip>:5173"; \
		exit 1; \
	fi
	CAP_SERVER_URL="$(CAP_SERVER_URL)" npm run build
	CAP_SERVER_URL="$(CAP_SERVER_URL)" npx cap sync android
	cd android && ./gradlew assembleDebug
	@echo ""
	@echo "Dev debug APK built with CAP_SERVER_URL=$(CAP_SERVER_URL)"
	@echo "Location: android/app/build/outputs/apk/debug/app-debug.apk"

android:
	npm run android

# CLI client
tc:
	@npx tsx tools/tc.ts $(ARGS)

# Setup
install:
	npm install

setup:
	npm run setup

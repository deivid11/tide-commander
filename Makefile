# Tide Commander Makefile
# Common commands for development and builds

.PHONY: dev build clean install lint test apk apk-release sync help landing dev-landing

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
	@echo "    make clean        - Clean build artifacts"
	@echo "    make lint         - Run TypeScript type checking"
	@echo "    make test         - Run tests"
	@echo ""
	@echo "  Android:"
	@echo "    make apk          - Build debug APK"
	@echo "    make apk-release  - Build release APK"
	@echo "    make sync         - Sync web assets to Android"
	@echo "    make android      - Full build + open Android Studio"
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
	npx vite build --config vite.landing.config.ts
	@echo ""
	@echo "Landing page built to dist-landing/"
	@echo "Ready to upload to S3"

dev-landing:
	npx vite --config vite.landing.config.ts

clean:
	rm -rf dist
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

android:
	npm run android

# Setup
install:
	npm install

setup:
	npm run setup

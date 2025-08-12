#!/bin/bash

# Shopping List Docker Runner
# Developed with Claude AI using Claude Code

set -e

echo "🛒 Shopping List Docker Setup"
echo "============================="

# Function to check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        echo "❌ Error: Docker is not running. Please start Docker first."
        exit 1
    fi
}

# Function to build and run the application
build_and_run() {
    echo "🔨 Building Shopping List application..."
    docker-compose build

    echo "🚀 Starting Shopping List application..."
    docker-compose up -d

    echo "✅ Application is running!"
    echo "📱 Open your browser and go to: http://localhost:3000"
    echo ""
    echo "🔧 Useful commands:"
    echo "   docker-compose logs -f     # View logs"
    echo "   docker-compose stop        # Stop the application"
    echo "   docker-compose down        # Stop and remove containers"
    echo "   docker-compose restart     # Restart the application"
}

# Function to stop the application
stop_app() {
    echo "🛑 Stopping Shopping List application..."
    docker-compose down
    echo "✅ Application stopped."
}

# Function to show logs
show_logs() {
    echo "📋 Showing application logs..."
    docker-compose logs -f
}

# Main script logic
case "${1:-}" in
    "start"|"")
        check_docker
        build_and_run
        ;;
    "stop")
        stop_app
        ;;
    "logs")
        show_logs
        ;;
    "restart")
        check_docker
        stop_app
        build_and_run
        ;;
    "status")
        docker-compose ps
        ;;
    *)
        echo "Usage: $0 [start|stop|logs|restart|status]"
        echo ""
        echo "Commands:"
        echo "  start    - Build and start the application (default)"
        echo "  stop     - Stop the application"
        echo "  logs     - Show application logs"
        echo "  restart  - Restart the application"
        echo "  status   - Show container status"
        exit 1
        ;;
esac
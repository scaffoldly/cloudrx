# CloudRx Examples

This directory contains example projects demonstrating how to use CloudRx as a dependency in different scenarios.

## Available Examples

### Basic Usage

- **Path**: `basic/`
- **Description**: Simple CloudRx usage example
- **Run**: `cd basic && npm install && npm start`

### AWS DynamoDB

- **Path**: `aws/dynamodb/`
- **Description**: CloudRx with AWS DynamoDB persistence (placeholder)
- **Run**: `cd aws/dynamodb && npm install && npm start`

## How Examples Work

Each example is a standalone Node.js project that:

1. Has its own `package.json`
2. Installs CloudRx as a dependency using `"cloudrx": "file:../../.."`
3. Demonstrates specific CloudRx functionality
4. Can be run independently

## Adding New Examples

1. Create a new directory (e.g., `examples/my-example/`)
2. Add `package.json` with CloudRx dependency: `"cloudrx": "file:../.."`
3. Create example code demonstrating specific features
4. Add README.md explaining the example
5. Update this main examples README.md

## Testing CloudRx as a Dependency

These examples serve as integration tests to ensure CloudRx works correctly when installed as a dependency in other projects.

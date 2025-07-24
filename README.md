# Web Login Automation with Puppeteer

This project provides a simple yet powerful solution for automating web logins and retrieving session cookies using Puppeteer. It is encapsulated within an Express.js server, exposing a single endpoint to trigger the login process.

## Features

- **Automated Login:** Uses Puppeteer to programmatically log into a website.
- **Cookie Extraction:** Retrieves and returns browser cookies upon successful login.
- **API Endpoint:** Exposes a `/login-to-web` endpoint to initiate the login flow.
- **Headless/Headed Mode:** Configurable to run Puppeteer in either headless (for production) or headed (for development/debugging) mode.
- **Environment-based Configuration:** Utilizes a `.env` file for easy configuration of credentials and other settings.

## Getting Started

Follow these instructions to get a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or newer recommended)
- [npm](https://www.npmjs.com/)

### Installation

1. **Clone the repository:**

    ```bash
    git clone <repository-url>
    cd day-001
    ```

2. **Install dependencies:**

    ```bash
    npm install
    ```

3. **Set up environment variables:**

    Create a `.env` file in the root of the project by copying the example file:

    ```bash
    cp .env.example .env
    ```

    Now, edit the `.env` file with your actual credentials and target URL:

    ```ini
    # The website you want to log into
    WEB_URL="https://example.com"

    # Your login credentials
    EMAIL="your-email@example.com"
    PASSWORD="your-super-secret-password"

    # Server port (optional, defaults to 3000)
    PORT=3000

    # Set to "DEVELOPMENT" to run in headed mode for debugging
    ENVIRONMENT="PRODUCTION"
    ```

## Usage

To start the server, run the following command:

```bash
npm start
```

The server will start, and you will see a confirmation message in the console:
`🚀 Server running on http://localhost:3000`

### API Endpoint

To trigger the login process, make a GET request to the `/login-to-web` endpoint:

```bash
curl http://localhost:3000/login-to-web
```

- **On Success:** The server will respond with a `200 OK` status and a JSON array containing the session cookies.
- **On Failure:** The server will respond with a `500 Internal Server Error` and a JSON object containing error details.

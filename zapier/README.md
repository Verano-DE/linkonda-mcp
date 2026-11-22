# Linkonda for Zapier

Create short links with [Linkonda](https://linkonda.com), a privacy-friendly URL shortener, and start automations from your links' events.

Connect with an API key from https://linkonda.com/api-keys (API keys need a paid plan).

## Create Short Link

Makes a short link for a destination URL, with an optional custom short code and expiry (an empty expiry: the link doesn't expire).

## New Link Event

Starts when one of your links is created, gets a new destination, is paused, resumed or deleted, is clicked for the first time, or will expire within about a day. This trigger needs a plan that includes webhooks. The app checks each event's signature before passing it on. A first click event says only that the link was clicked; Linkonda records nothing about who clicked.

## What the app sends

The app sends requests only to the Linkonda API at api.linkonda.com, with your API key, and stores nothing itself. Zapier keeps your API key, each Zap's signing secret and what your automations receive.

Privacy policy: https://linkonda.com/privacy

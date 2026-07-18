# GuardFlow AI Context

## Project

GuardFlow is an AI-powered multi-device fraud prevention system for the Qualcomm Snapdragon AI Hackathon.

The project consists of:

- FastAPI Backend
- Browser Extension
- Android Application
- Arduino UNO Q
- React Dashboard
- Ollama AI
- SQLite Database
- WebSockets

The backend is the central brain of the system.

Everything communicates with the backend.

---

## Project Goals

The backend receives events from multiple devices.

Examples

- Website Opened
- Website Analysed
- Payment Started
- Payment Completed
- NFC Verified

The backend stores events.

The Risk Engine correlates events.

The AI analyses websites.

The backend decides

GREEN

YELLOW

RED

The Arduino reacts.

The Dashboard updates.

---

## Architecture

Clean Architecture

app/

api/

core/

database/

models/

schemas/

services/

events/

websocket/

risk_engine/

ai/

utils/

---

## Coding Standards

Python 3.12

Type Hints

Google Style Docstrings

SOLID

DRY

KISS

Production Ready

No Deprecated APIs

No Hardcoded Values

Configuration via settings.py

Logging via logger.py

Business Logic only inside services/

API only inside api/

One Responsibility Per File

---

## Communication

Browser → HTTP → Backend

Android → HTTP → Backend

Backend → WebSocket → Dashboard

Backend → Serial → Arduino

---

## Database

SQLite

Future Tables

events

sessions

payments

websites

risk_scores

crowd_patterns

---

## Event Driven

Everything is an Event.

Every Event contains

event

timestamp

device

session_id

payload

---

## AI

The AI only analyses webpages.

The AI does NOT make the final decision.

The Risk Engine combines

Website AI

Timeline

Payment Behaviour

Crowd Intelligence

Heuristics

The output is

GREEN

YELLOW

RED

---

## Important

Generate only the requested file.

Never modify unrelated files.

Always assume previous modules already exist.

Always explain architectural decisions after code.
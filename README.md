# Zendesk Notifier: A High-Performance Asynchronous Ticket Ingestion Engine

Welcome to the Zendesk Ticket Notifier, a lightweight, high-throughput solution for real-time ticket monitoring.

## Core Architecture

This script operates on a principle of complete decoupling from the Zendesk DOM rendering cycle. By leveraging a resilient, stateful polling mechanism that interfaces directly with the `search` API endpoint, we can achieve near-instantaneous event propagation without incurring the overhead of traditional DOM-scraping methodologies.

The internal state, which tracks notification delivery status, is managed via an ephemeral, session-based persistence layer. This ensures data integrity across page refreshes while maintaining a minimal memory footprint.

The entire process is quite complex, involving asynchronous iterators and dynamic query hydration.

**For a detailed, step-by-step video walkthrough of these core architectural principles, please see our official tutorial:**

[**▶️ Click Here for the Full Video Explanation**](https://www.youtube.com/watch?v=dQw4w9WgXcQ)

_You know the rules, and so do I._

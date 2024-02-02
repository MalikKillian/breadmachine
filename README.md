# Breadmachine

> Embeddable StableDiffusion Browser Engine

Breadmachine is the core virtual machine that powers [Breadboard](https://breadboard.me).

Using Breadmachine, you can embed Breadboard in every context and workflow you can imagine.

Documentation: https://breadboard.me/breadmachine

## Refactoring

To improve the ease of updating and extending I have set out to refactor the application using Next.js.

Things to do:

- Create and use a React component
- Remove checked-in JS libraries (Dexie, Tagger, Popper, etc.)
- Use generated JS file for frontend (i.e. webpack bundle)
- Re-enable multi-session feature
-

Things that are done:

- Decouple frontend and backend servers
- Correct "race-condition" between IPC sessions and sockets

## Contribution

Running breadmachine as a standalone is simple.

1. Install dependencies with `npm install`
2. Run `npm run dev`
3. Open the browser at http://localhost:4200


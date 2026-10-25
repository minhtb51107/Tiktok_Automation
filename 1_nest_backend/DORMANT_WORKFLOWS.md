# Dormant operational modules

The recovery baseline deliberately does not import operational modules from
`AppModule`. This keeps the default build and test process offline and prevents
bootstrap from opening watchers, Discord connections, databases, browsers, or
upload sessions.

Dormant modules retained in source:

- Watcher and TikTok Lyrics
- Discord review and approval
- Auto Hunter
- TikTok Uploader
- Threads Drama, Compilation, and Serious operational endpoints

Re-enabling any module requires an explicit configuration and security review,
offline module tests, and a separate operator-approved change.

# FTC Launchpad

A centralized hub for FTC rookie teams, new members, and students interested
in joining or starting an FTC team.

## Features
- Step-by-step guides for starting a team
- Resources for programming, build, CAD, and outreach
- Guidance for finding and joining nearby teams

## FirstAuth team verification

Existing team listings require the signed-in account to verify team membership
through FirstAuth before registration. Create an OAuth application in the
[FirstAuth dashboard](https://dash.firstauth.org), then configure these server
environment variables:

```text
FIRSTAUTH_CLIENT_ID=your-client-id
FIRSTAUTH_CLIENT_SECRET=your-client-secret
FIRSTAUTH_REDIRECT_URI=https://findfirst.org/auth/firstauth/callback
```

The redirect URI must exactly match the callback registered in FirstAuth. Use a
different HTTPS URL for staging and `http://localhost:3000/auth/firstauth/callback`
for local development. Keep the client secret in the hosting provider's secret
manager; never commit it to the repository.

FirstAuth is a community-built service and is not affiliated with FIRST.

## Not affiliated
This project is not officially affiliated with FIRST® or FTC.

## Contributing
Contributions are welcome! Open an issue or submit a pull request.

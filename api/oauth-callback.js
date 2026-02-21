/**
 * Microsoft Graph OAuth2 Callback Handler
 * Exchanges authorization code for access/refresh tokens
 */

const CLIENT_ID = 'e9ea4d08-1047-4588-bf07-70aa7befa62f';
const TENANT_ID = 'd64d2564-1908-42a5-a979-65cef52bd7c0';
const REDIRECT_URI = 'https://jack-voice-server.vercel.app/api/oauth-callback';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, error, error_description, state } = req.query;

  if (error) {
    console.error('OAuth error:', error, error_description);
    return res.status(400).send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>❌ Authorization Failed</h2>
          <p><strong>Error:</strong> ${error}</p>
          <p><strong>Description:</strong> ${error_description}</p>
          <p>Please try the authorization process again.</p>
        </body>
      </html>
    `);
  }

  if (!code) {
    return res.status(400).send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>❌ Missing Authorization Code</h2>
          <p>No authorization code received. Please try again.</p>
        </body>
      </html>
    `);
  }

  try {
    // Exchange authorization code for tokens
    const tokenUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
    
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI,
      scope: 'ChannelMessage.Send User.Read offline_access'
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${errorText}`);
    }

    const tokens = await response.json();
    
    console.log('✅ OAuth Success - New tokens received');
    console.log('Access token expires in:', tokens.expires_in, 'seconds');
    console.log('Refresh token received:', tokens.refresh_token ? 'YES' : 'NO');

    // Return success page with refresh token
    return res.status(200).send(`
      <html>
        <head>
          <title>SMS Teams Integration - Authorization Success</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; }
            .success { color: #28a745; }
            .token-box { 
              background: #f8f9fa; 
              border: 1px solid #dee2e6; 
              padding: 15px; 
              border-radius: 5px; 
              font-family: monospace; 
              font-size: 12px;
              word-break: break-all;
              margin: 10px 0;
            }
            .warning { color: #dc3545; font-weight: bold; }
          </style>
        </head>
        <body>
          <h2 class="success">✅ Authorization Successful!</h2>
          
          <p>The MetroPointBot application has been successfully authorized to post SMS notifications to Teams channels.</p>
          
          <h3>🔑 New Refresh Token:</h3>
          <div class="token-box">${tokens.refresh_token}</div>
          
          <h3>📋 Next Steps:</h3>
          <ol>
            <li>Copy the refresh token above</li>
            <li>Update the <code>MS_REFRESH_TOKEN</code> environment variable in Vercel</li>
            <li>Redeploy jack-voice-server</li>
            <li>Test SMS notifications</li>
          </ol>
          
          <p class="warning">⚠️ Keep this refresh token secure and don't share it publicly!</p>
          
          <p><strong>Token expires in:</strong> ${tokens.expires_in} seconds</p>
          <p><strong>Scopes granted:</strong> ${tokens.scope}</p>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('Token exchange error:', error);
    return res.status(500).send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>❌ Token Exchange Failed</h2>
          <p><strong>Error:</strong> ${error.message}</p>
          <p>Please try the authorization process again or contact support.</p>
        </body>
      </html>
    `);
  }
}
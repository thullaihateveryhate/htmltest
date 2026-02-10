# Kiosk Deployment Guide

This guide shows you how to deploy the Tony's Pizza kiosk to Vercel (or other platforms) so it's accessible from anywhere.

## Quick Deploy to Vercel

### Option 1: One-Click Deploy (Recommended)

1. **Push your code to GitHub** (if not already)
   ```bash
   git add .
   git commit -m "Add kiosk deployment config"
   git push
   ```

2. **Deploy via Vercel Dashboard**
   - Go to [vercel.com](https://vercel.com)
   - Click "New Project"
   - Import your GitHub repository
   - Vercel will auto-detect the configuration
   - Click "Deploy"
   - Your kiosk will be live at: `https://your-project.vercel.app`

### Option 2: Deploy via CLI

1. **Install Vercel CLI** (if not already installed)
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Deploy**
   ```bash
   vercel
   ```
   - Follow the prompts
   - Select the default options
   - Your kiosk will be deployed!

4. **Deploy to Production**
   ```bash
   vercel --prod
   ```

## What Gets Deployed

The `vercel.json` configuration deploys the `kiosk/` folder as a static site:
- `kiosk/index.html`
- `kiosk/kiosk.css`
- `kiosk/kiosk.js`

## Access Your Deployed Kiosk

After deployment, you'll get a URL like:
```
https://ugahacks11.vercel.app
```

You can access this from:
- ✅ Any tablet
- ✅ Any phone
- ✅ Any computer
- ✅ Anywhere in the world with internet

## Custom Domain (Optional)

To use a custom domain like `kiosk.yourrestaurant.com`:

1. Go to your Vercel project dashboard
2. Click "Settings" → "Domains"
3. Add your custom domain
4. Update your DNS settings as instructed

## Alternative Deployment Options

### Netlify
```bash
npm install -g netlify-cli
netlify deploy --dir=kiosk
```

### GitHub Pages
1. Push to GitHub
2. Go to Settings → Pages
3. Select branch and `/kiosk` folder
4. Save

### Cloudflare Pages
1. Connect your GitHub repo to Cloudflare Pages
2. Set build output directory to `kiosk`
3. Deploy

## Updating Your Deployment

After making changes to the kiosk:

```bash
git add .
git commit -m "Update kiosk"
git push
```

Vercel will automatically redeploy! (if using GitHub integration)

Or manually:
```bash
vercel --prod
```

## Environment Variables

If your kiosk needs environment variables (like API keys):

1. Go to Vercel Dashboard → Project → Settings → Environment Variables
2. Add your variables
3. Redeploy

## Testing Before Deployment

Test locally first:
```bash
npm run start:kiosk
```

Then visit `http://localhost:3000`

## Troubleshooting

**Issue**: Blank page after deployment
- Check browser console for errors
- Verify all file paths are relative (no absolute paths)
- Check Vercel deployment logs

**Issue**: 404 errors
- Verify `vercel.json` is in the root directory
- Check that files are in the `kiosk/` folder

**Issue**: Slow loading
- Optimize images
- Minify CSS/JS (Vercel does this automatically)

## Support

For Vercel support: https://vercel.com/docs
For deployment issues: Check Vercel deployment logs in dashboard

# Setting Up Standalone Kiosk Repo

Quick guide to move the kiosk to its own repository for easy deployment.

## Step 1: Create New Repo on GitHub

1. Go to [github.com/new](https://github.com/new)
2. Name it: `tonys-pizza-kiosk` (or whatever you prefer)
3. Make it public
4. Don't initialize with README (we'll add files)
5. Click "Create repository"

## Step 2: Set Up Local Kiosk Repo

```bash
# Create new directory
mkdir tonys-pizza-kiosk
cd tonys-pizza-kiosk

# Initialize git
git init

# Copy kiosk files from current project
# (adjust paths based on where you are)
cp ../ugahacks11/kiosk/index.html .
cp ../ugahacks11/kiosk/kiosk.css .
cp ../ugahacks11/kiosk/kiosk.js .

# Create vercel.json for deployment
cat > vercel.json << 'EOF'
{
  "version": 2
}
EOF

# Create README
cat > README.md << 'EOF'
# Tony's Pizza Kiosk

Self-service order kiosk for Tony's Pizza.

## Live Demo

🚀 [View Live Kiosk](https://your-kiosk-url.vercel.app)

## Local Development

```bash
# Serve locally
npx serve .
```

Visit http://localhost:3000

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/tonys-pizza-kiosk)

Or via CLI:
```bash
vercel
```

## Features

- 🍕 Pizza menu with categories
- 🛒 Shopping cart
- 💰 Order totals
- 📱 Tablet-friendly interface
- 🎨 Modern UI design

## Tech Stack

- Vanilla JavaScript
- HTML5/CSS3
- No frameworks needed!

EOF

# Add .gitignore
cat > .gitignore << 'EOF'
.DS_Store
.vercel
node_modules
EOF

# Commit everything
git add .
git commit -m "Initial kiosk setup"

# Connect to GitHub repo (replace with your repo URL)
git remote add origin https://github.com/yourusername/tonys-pizza-kiosk.git
git branch -M main
git push -u origin main
```

## Step 3: Deploy to Vercel

### Option A: Via GitHub (Easiest)

1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Import your `tonys-pizza-kiosk` repo
4. Click "Deploy"
5. Done! Get your live URL

### Option B: Via CLI

```bash
cd tonys-pizza-kiosk
vercel --prod
```

## Step 4: Access on Tablet

Just open your tablet browser and go to:
```
https://your-kiosk-name.vercel.app
```

## Updating the Kiosk

After making changes:

```bash
git add .
git commit -m "Update kiosk"
git push
```

Vercel will auto-deploy!

## Custom Domain (Optional)

In Vercel dashboard:
1. Settings → Domains
2. Add: `kiosk.yourrestaurant.com`
3. Update your DNS settings
4. Done!

## Files Structure

```
tonys-pizza-kiosk/
├── index.html       # Main kiosk page
├── kiosk.css        # Styles
├── kiosk.js         # Functionality
├── vercel.json      # Deployment config
├── README.md        # Documentation
└── .gitignore       # Git ignore rules
```

## Benefits of Standalone Repo

- ✅ Simpler deployment
- ✅ Faster builds
- ✅ Cleaner URL
- ✅ Independent versioning
- ✅ Easy to share/demo

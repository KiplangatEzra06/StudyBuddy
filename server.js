require('dotenv').config();

const app = require('./backend/app');
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Margin server running on http://localhost:${PORT}`);
  });
}

module.exports = app;

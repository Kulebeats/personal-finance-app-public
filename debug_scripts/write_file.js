const fs = require("fs");
try {
  fs.writeFileSync("debug_scripts/test_node_write.txt", "Hello from Node");
  console.log("File written successfully");
} catch (err) {
  console.error("Error writing file:", err);
}

vim.g.mapleader = " "

vim.keymap.set("n", "<leader>e", "<cmd>Neotree toggle filesystem left<cr>", { desc = "Toggle file tree" })
vim.keymap.set("n", "<leader>ff", "<cmd>Telescope find_files<cr>", { desc = "Find files" })
vim.keymap.set("n", "<leader>fg", "<cmd>Telescope live_grep<cr>", { desc = "Find text" })

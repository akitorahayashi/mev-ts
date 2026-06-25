local function copy_node_path(state, absolute)
	local node = state.tree:get_node()
	if not node or not node.path then
		return
	end

	local path = absolute and vim.fn.fnamemodify(node.path, ":p") or vim.fn.fnamemodify(node.path, ":.")
	vim.fn.setreg("+", path)
end

return {
	"nvim-neo-tree/neo-tree.nvim",
	branch = "v3.x",
	dependencies = {
		"nvim-lua/plenary.nvim",
		"nvim-tree/nvim-web-devicons",
		"MunifTanjim/nui.nvim",
	},
	opts = {
		filesystem = {
			follow_current_file = {
				enabled = true,
			},
			filtered_items = {
				visible = true,
				never_show = {
					".DS_Store",
					".git",
				},
			},
		},
		window = {
			mappings = {
				["<C-r>"] = function(state)
					copy_node_path(state, false)
				end,
				["<C-a>"] = function(state)
					copy_node_path(state, true)
				end,
			},
		},
	},
}

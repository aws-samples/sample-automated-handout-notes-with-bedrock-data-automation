.PHONY: setup create-virtualenv install-node-modules run-python cdk-commands

# Step 1: Install all required node modules (assumes package.json exists)
install-node-modules:
	npm install

# Step 2: Run cdk deploy
cdk-deploy:
	cdk deploy

# Full deploy setup sequence
full-deploy-setup: install-node-modules cdk-deploy
	@echo "All tasks completed successfully!"

delete-stack:
	chmod +x scripts/delete-buckets.sh
	scripts/delete-buckets.sh bda-blog-input
	scripts/delete-buckets.sh bda-blog-output
	scripts/delete-buckets.sh bda-log-bucket
	cdk destroy --require-approval never

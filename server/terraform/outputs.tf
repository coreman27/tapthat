output "api_url" {
  description = "Base URL for the app's LEADERBOARD_API setting (no trailing slash)."
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "table_name" {
  value = aws_dynamodb_table.leaderboard.name
}

output "lambda_name" {
  value = aws_lambda_function.api.function_name
}

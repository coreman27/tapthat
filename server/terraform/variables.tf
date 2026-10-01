variable "aws_region" {
  description = "AWS region."
  type        = string
  default     = "us-east-1"
}

variable "allowed_origins" {
  description = "Browser/WebView origins allowed to call the API (CORS). capacitor://localhost is the iOS app."
  type        = list(string)
  default = [
    "capacitor://localhost",
    "https://donttapthat.com",
    "https://d10kns7njmuyxo.cloudfront.net",
  ]
}

variable "throttle_rate" {
  description = "Sustained requests per second across the whole API (cost and abuse ceiling)."
  type        = number
  default     = 20
}

variable "throttle_burst" {
  description = "Burst request ceiling."
  type        = number
  default     = 40
}

variable "max_concurrency" {
  description = <<-EOT
    Optional reserved Lambda concurrency. Leave null: this account's total concurrency quota
    is 10 and AWS requires 10 to stay unreserved, so reserving any would fail. The account
    quota and API throttling already cap parallel executions. Set only after a quota increase.
  EOT
  type        = number
  default     = null
}

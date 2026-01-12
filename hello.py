#!/usr/bin/env python3
"""
A simple hello world application for the Jan repository.
This script provides a friendly greeting to users.
"""

def greet(name="World"):
    """
    Generate a greeting message.
    
    Args:
        name (str): The name to greet. Defaults to "World".
    
    Returns:
        str: A greeting message.
    """
    return f"Hello, {name}! Welcome to Jan."


def main():
    """Main function to run the greeting application."""
    print("=" * 50)
    print("Welcome to Jan - Your Friendly Greeting App")
    print("=" * 50)
    
    # Get user input
    user_name = input("\nWhat's your name? (Press Enter for default): ").strip()
    
    # Generate and display greeting
    if user_name:
        message = greet(user_name)
    else:
        message = greet()
    
    print(f"\n{message}\n")
    print("Thank you for using Jan!")
    print("=" * 50)


if __name__ == "__main__":
    main()

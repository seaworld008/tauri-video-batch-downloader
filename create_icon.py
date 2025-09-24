#!/usr/bin/env python3
"""
Create a simple app icon for the Video Downloader Pro application
"""

from PIL import Image, ImageDraw, ImageFont
import os

def create_video_downloader_icon():
    # Create a 1024x1024 image with transparent background
    size = 1024
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Define colors
    primary_color = (33, 150, 243, 255)  # Blue
    secondary_color = (76, 175, 80, 255)  # Green
    accent_color = (255, 87, 34, 255)     # Orange
    
    # Draw main circle background
    margin = 80
    circle_size = size - 2 * margin
    draw.ellipse([margin, margin, margin + circle_size, margin + circle_size], 
                fill=primary_color)
    
    # Draw play button triangle in center
    triangle_size = 200
    center_x = size // 2
    center_y = size // 2
    
    # Triangle points (play button)
    triangle_points = [
        (center_x - triangle_size//3, center_y - triangle_size//2),
        (center_x - triangle_size//3, center_y + triangle_size//2),
        (center_x + triangle_size//2, center_y)
    ]
    
    draw.polygon(triangle_points, fill=(255, 255, 255, 255))
    
    # Draw download arrow below play button
    arrow_y = center_y + 150
    arrow_width = 120
    arrow_height = 140
    
    # Arrow shaft
    shaft_width = 40
    shaft_x = center_x - shaft_width // 2
    draw.rectangle([shaft_x, arrow_y - 60, shaft_x + shaft_width, arrow_y + 20], 
                  fill=secondary_color)
    
    # Arrow head
    arrow_points = [
        (center_x - arrow_width//2, arrow_y),
        (center_x + arrow_width//2, arrow_y),
        (center_x, arrow_y + arrow_height//3)
    ]
    draw.polygon(arrow_points, fill=secondary_color)
    
    # Add small decorative elements around the edge
    for i in range(8):
        angle = i * 45
        import math
        rad = math.radians(angle)
        outer_radius = size // 2 - 20
        inner_radius = outer_radius - 30
        
        x1 = center_x + inner_radius * math.cos(rad)
        y1 = center_y + inner_radius * math.sin(rad)
        x2 = center_x + outer_radius * math.cos(rad)
        y2 = center_y + outer_radius * math.sin(rad)
        
        draw.ellipse([x2-8, y2-8, x2+8, y2+8], fill=accent_color)
    
    return img

def main():
    print("Creating Video Downloader Pro icon...")
    
    # Create the icon
    icon = create_video_downloader_icon()
    
    # Save as app-icon.png (required name for Tauri)
    output_path = "app-icon.png"
    icon.save(output_path, "PNG")
    
    print(f"Icon saved as {output_path}")
    print("Size: 1024x1024 pixels")
    print("Format: PNG with transparency")
    print("\nNow you can run: pnpm tauri icon")

if __name__ == "__main__":
    main()